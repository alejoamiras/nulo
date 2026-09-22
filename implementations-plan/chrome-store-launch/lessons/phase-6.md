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

## Arc 2 codex fix loop

### Round 1 — reject (3 must-fix, 3 should-fix), all verified against the repo and fixed (`fae07730`)

| # | Finding | Verified | Fix |
|---|---|---|---|
| M1 | A stable tag on a commit whose `apps/extension/package.json` is at another version passes every gate: the build takes `version_override` from the tag (`release.yml:248`) while `git archive` keeps the tree's version, so AMO receives a source package whose own rebuild script refuses it | yes | `checkSourceArchive` also requires `nulo-<v>/apps/extension/package.json` with `version === VERSION`; the runner reads it through `Files.zipText` (`unzip -p`); tests on both layers |
| M2 | `SOURCE-BUILD.md` said Node is unused; `build:firefox` runs `cross-env` and `vite`, both Node programs, under the ambient Node | yes (their shebangs; no `--bun`) | the document names Node as the runtime Vite runs under; `source-rebuild.sh` prints the Node it found |
| M3 | `SOURCE-BUILD.md` counted two patch files; `patches/` holds four (two packages × two versions), all activated by `patchedDependencies` | yes | four, named, matching the reviewer notes |
| S1 | A throw between the create request and the source PATCH (an unreadable source archive) reached the outer catch, which prints `unexpected failure (Error)` without the recovery | yes | both files are read into memory before the first request; the create and the PATCH are each wrapped so any throw after the create carries `RECOVERY`; tested with a fetch that throws on the 4th call |
| S2 | `actions/upload-artifact` drops dotfiles by default, so a hidden file present in only one tree survives neither the reference nor the rebuild artifact and `compare` passes | yes (`include-hidden-files` defaults false at the pinned SHA) | `include-hidden-files: true` on every upload in `source-rebuild.yml` and on both in `_build-extension.yml` |
| S3 | The credential check read one page of the author-scoped list (25 by default) and reported absence | yes | `?page_size=50`, `next` links followed up to `OWN_ADDONS_MAX_PAGES = 10` (a `next` outside `AMO_API` is ignored), "not found in the first N pages" is distinct from absence; tests for a third-page hit and the cap |

### Round 2 — reject (3 must-fix); the six round-1 fixes confirmed

| # | Finding | Verified | Fix |
|---|---|---|---|
| M4 | The round-1 Node sentence said the release builds use Node 24; no workflow selects Node and the Ubuntu 24.04 runner defaults to 22.23.2 | yes (run 35670945252's `== node v22.23.2 runs vite` on both runners) | already corrected at `e6a8751d`, before this round's response landed: the document states Node 22 on the runners, Node 24.18.0 on the workstation, identical trees |
| M5 | "No minified or generated code is checked in" — the archive holds generated `src/types/*.d.ts`, rendered `packages/design/src/tokens.ts` and the vendored `SchnorrAccount.json` | yes | the sentence names all three, with the generator or provenance of each |
| M6 | The recovery regression test's `jti` throw was assigned after the run and never invoked; the fetch throw it did exercise is caught by `call()`, so deleting both guards kept the test green | yes | `jti` throws on the 4th (PATCH) and 3rd (create) request, before the fetch; each asserts the recovery; the fetch-throw case is its own test |

### Round 3 — approve

> No new or unresolved material findings. All three fixes are verified; 157 release tests pass.
> > verdict: approve — confidence: high. Live AMO behavior, environment protections, rebuild execution, extension tests, and Mozilla policy acceptance remain independently unverified.

Arc 2 loop converged (three rounds; transcripts in `audit-codex.md` under "Arc 2 implementation"). Every fix was rebuilt by `source-rebuild.yml` on push: runs 35669743682 (`c67d19bc`), 35670945252 (`fae07730`), 35671260446 (`0dac1301`).

## Cross-stack codex pass

### Round 1 — conditional (0 must-fix, 3 should-fix), all verified and fixed

| # | Finding | Verified | Fix |
|---|---|---|---|
| S1 | The Firefox runner checked the manifest version by prefix, so `0.27.0.9` passed for `VERSION=0.27.0` (upload → version → source, exit 0) while the Chrome runner rejects it; the attached source rebuilds `0.27.0.0` | yes | `derivedStoreVersion()` mirrors `manifest.config.ts` (strip non-digits, pad to four) and the manifest version must equal it; `0.27.0.9` refused, `0.27.0-rc.1` → `0.27.0.1` tested |
| S2 | `remote-code.md` paraphrased privacy § 2 as "forbids loading remote scripts" where the policy says "remote code", then concluded both sentences are true — but the note itself shows the CSP does not govern WASM bytes | yes | the note quotes both sentences verbatim, keeps § 13 as true, states § 2's attribution to the CSP is more than the policy delivers, and flags the rewording as an owner item (`BEFORE-LAUNCH.md` § 2). `legal/*.md` is not edited by this plan |
| S3 | `BEFORE-LAUNCH.md` required the privacy page out of draft before submission (§ 2) while dating it on the day 1.0 ships (§ 3); the date placeholder alone keeps the banner | yes | § 2 states the sequence (privacy date = planned submission day, three places), § 3 keeps the Terms only, with a confirm-unchanged line for privacy |

### Round 2 — approve

> No new or unresolved material findings. All three fixes verified at `6306838e`; 158 release tests pass, and the original version mismatch now fails before any network call.
> > verdict: approve — confidence: high; live credentials/environment protections, store execution and acceptance, builds, reproducibility execution, E2E, and extension unit tests remain unverified. The privacy-policy rewording remains explicitly tracked as owner work before submission.

Cross-stack pass converged (two rounds). Both loops' transcripts: `audit-codex.md`. The `push:` trigger of `source-rebuild.yml` is removed in the arc's final, trigger-only commit; the last green rebuild (run 35671809803) ran on `6306838e`, the parent of the docs commits that precede it — no build input changed after that run.

`LESSONS_FILE=implementations-plan/chrome-store-launch/lessons/phase-6.md`
