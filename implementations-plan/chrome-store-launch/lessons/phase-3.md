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

## Arc 1 codex fix loop

### Round 1 — reject (4 must-fix, 2 should-fix), all verified against the repo and fixed

| # | Finding | Verified | Fix |
|---|---|---|---|
| M1 | An async upload answered for another item (`itemId: "different", uploadState: "IN_PROGRESS"`) was polled and then published for ours | yes: `interpretUpload` checked the id only on `SUCCEEDED`; polling never checked it | the id is checked on every upload response and on every poll (`interpretAsyncUploadState(status, itemId)`); runner test "an async upload answered for another item is never polled to a publish" |
| M2 | Preflight allowed `DEPLOYING`, `UNPUBLISHED`, `TAKEN_DOWN`, `ITEM_STATE_UNSPECIFIED`, none with known semantics for an upload | yes: the set was wider than Google's documented `ItemState` | the set is exactly `PENDING_REVIEW, STAGED, PUBLISHED, PUBLISHED_TO_TESTERS, REJECTED, CANCELLED`; each undocumented value now fails in a test |
| M3 | The long description said the extension talks *only* to the node, the price service and approved apps — the CRS hosts and the local prover are missing | yes: `legal/privacy.md` § 5.8–5.9 and the inventory two rows down say otherwise | the sentence names all five destinations |
| M4 | `remote-code.md` presented the CSP as proving the WASM is bundled; `'wasm-unsafe-eval'` allows compiling bytes from anywhere and there is no `connect-src` | yes | bundling is now stated as a property of the loaders (`acvm_js.js:924` module-relative URL; `bb-fetch-code.ts:15-18` extension-origin fetch), with the CSP's actual reach and its limit spelled out |
| S1 | `publishedItemRevisionStatus: null` threw a raw `TypeError` out of the CLI | yes | `revisionState()` treats anything present-but-not-an-object as unknown; the runner wraps the whole run and reports an unexpected throw by class name only (tested with a zip reader that throws a message containing the token) |
| S2 | `acir_callback.ts:8-10` cites `UnavailableOracleError`, not the callback builder | yes | cites `buildACIRCallback` at `:21-36` and says what it does |

Also hardened while there: `distributionChannels` entries that are not objects or carry a non-string `crxVersion` fail preflight; `describe()` in check mode tolerates malformed revisions.

### Round 2 — reject (1 must-fix); the six round-1 fixes confirmed

| # | Finding | Verified | Fix |
|---|---|---|---|
| M5 | The round-1 hardening turned a present non-array `distributionChannels` into `[]`, so `{ state: "PUBLISHED", distributionChannels: { crxVersion: "99.0.0.0" } }` let `0.27.0.0` upload and publish | yes: reproduced with the runner harness | a present non-array fails preflight ("unreadable distributionChannels"); pure test on both revisions, runner test asserts `fetchStatus` only |

### Round 3 — approve

> verdict: approve — confidence: high; the round-2 finding is resolved at `feb03368`, all earlier fixes remain intact, and no material findings remain; 120 release tests and icon drift checks pass, while store unit tests remain unverified after prior worker timeouts, alongside live WIF/environment protections, store acceptance, builds and E2E.

Arc 1 loop converged (three rounds; transcripts in `audit-codex.md` under "Arc 1 implementation"). The store unit tests codex could not start (vitest workers timed out in its sandbox) were run here: `bun run --cwd apps/extension test -- scripts/store` is green.
