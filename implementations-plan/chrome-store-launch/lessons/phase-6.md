# Phase 6 — Firefox publish job

## What changed

- `scripts/release/publish-firefox-amo.ts` (pure): the HS256 JWT (`node:crypto`, `exp = iat + 60`), the five API v5 request builders (upload, upload status, version create, source PATCH, author-scoped list), their interpreters, `checkFirefoxManifest` (Firefox build of this release, `gecko.id === "wallet@nulo.sh"`, `data_collection_permissions.required` equal to the settled `["financialAndPaymentInfo"]`, the manifest's numeric version retained for every AMO comparison), `checkSourceArchive` (prefixed `SOURCE-BUILD.md` + `bun.lock`, < 200 MB), `reviewerNotes` (the block between `listing.md`'s markers), `RECOVERY`.
- `scripts/release/publish-firefox-amo-run.ts`: `MODE` publish | check, strict `DRY_RUN`, every input checked before any request, the secret and every JWT masked, upload → poll (5-minute deadline) → version → source; any failure after the create request was sent carries the recovery procedure. `realFetch` builds multipart bodies with Bun's `FormData`; zips are read through `unzip` (Bun.Archive is tar-only).
- `release.yml`: `publish-firefox-amo` body — `environment: firefox-add-ons`, `contents: read` only, checksum line for the Firefox zip, `git archive --format=zip --prefix=nulo-<v>/` as the source package, the two secrets on the one publish step. `store-check.yml`: `store` grows `firefox` and `both`; a `firefox` job runs `MODE=check`.
- Docs: `CI.md` (§ release.yml store paragraph, known limitations), `CLAUDE.md` (runbook step 6, a troubleshooting row for the post-`version ok` failure and a foreign key pair), `.github/README.md` (store-check options, a `source-rebuild.yml` row that Phase 5 had not added).

## Findings

- **The shipped v0.27.0 Firefox zip carries `gecko.id: "{}"`** (literally the string `{}`), from before the Firefox build was first-class. The runner refuses it (`gecko.id "{}" is not wallet@nulo.sh`), which is the intended behaviour; it also means no published release can serve as a dry-run input — Phase 5's build of this branch does, as the plan says.
- A throw inside the injected `fetch` is a request failure by design (`call()` catches it), so the "unexpected throw" test has to throw from another injected point (`jti`); the raw message, which contains the fake secret, never reaches the log.
- Bun's `FormData` + `Blob` produce a `multipart/form-data` body with a boundary (probed before writing; `Request.arrayBuffer()` shows it), so no multipart encoder is needed.
- The JWT known-answer vector in the test was minted once from the module and pinned; the test also decodes the header and payload to assert `alg`, `typ` and `exp - iat`.

## Validation gate

| Layer | Command | Result |
|---|---|---|
| unit | `bun run test:release` | 151 tests passed across 12 files (31 new) |
| lint | `bun run lint` | exit 0 |
| actionlint | `bun run lint:actions` | exit 0 |
| dry run | `git archive --format=zip --prefix=nulo-0.27.0/ … HEAD`, zip of Phase 5's `dist/firefox`, `MODE=publish DRY_RUN=true VERSION=0.27.0 ZIP_PATH=… SOURCE_PATH=… LISTING_PATH=apps/extension/store/listing.md bun scripts/release/publish-firefox-amo-run.ts` | exit 0: `zip ok … settled data declaration`, `source ok … reviewer notes: 2279 chars`, `no request was made` |
| dry run, refusals | the Chrome zip; the released v0.27.0 Firefox zip; `MODE` unset | exit 1 each, before any request |

`LESSONS_FILE=implementations-plan/chrome-store-launch/lessons/phase-6.md`
