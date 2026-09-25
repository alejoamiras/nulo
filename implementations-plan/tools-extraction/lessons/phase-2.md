# Stage 2 — N2 (publishable packages) and N3 (landing config)

## N3 — landing Worker config (A3, #693)

**Baseline captured 2026-09-24 against `https://nulo.sh` (Pages).**

- **200 with the site's HTML:** `/`, `/terms`, `/privacy`, `/terms/v1.0/`, `/forms/uninstall`, `/forms/uninstall/`, `/does-not-exist`, `/favicon.ico`, `/_headers`.
- **308 to the clean URL:** `/terms/`, `/terms.html`, `/index.html`, `/terms/v1.0`.
- **Headers:** every response carries the full `public/_headers` set. Assets add `cache-control: public, max-age=31536000, immutable`.
- **Consequence:** Pages already serves `index.html` for unknown paths, so `not_found_handling: "single-page-application"` changes nothing users see.

**Local parity.** `wrangler dev --local` (wrangler 4.129.1) served the same build with identical statuses and header sets. It differs from Pages in two ways:

- redirects are **307**, not 308;
- JS is served as `text/javascript`, not `application/javascript`.

**`wrangler deploy --dry-run` needs no credentials** for an assets-only config. wrangler excludes `_headers`, `_redirects` and `.assetsignore` from the uploaded assets and sends them as config (`createAssetsIgnoreFunction`).

**Codex (session `01a0d540`), five rounds:**

1. **Changes needed.** The README claimed both hosts rebuild. A bad `CLOUDFLARE_LANDING_DEPLOY_HOOK` could report success. Per-Worker token roles exist (verified in Cloudflare's docs: the Editor role, only for a Worker that already exists, and Custom Domains do not support per-Worker roles).
2. **Changes needed.** jq's `//` treated `false` as missing. The URL prefix accepted an empty id and glob syntax.
3. **Approve.** Hook checks tested against 12 response bodies and 8 URLs.
4. **Owner decision 25: no hook for the Worker.** The workflows returned to `dev`'s text.
   - *Why:* the Worker builds only through the Workers Builds Git connection set up in the dashboard.
   - *What was dropped:* the `LANDING || PAGES` fallback and its checks, reverted in `1cf4c146`.
   - *New cut-over step:* the owner re-runs the Worker's production build before `nulo.sh` is attached. The Release-PR build runs before the release has its zip, so attaching without a re-run would serve the previous release.
5. **Approve** on the net diff (`112d878f`).

## N2 — staged packages (A2)

**The bundler labels modules by path relative to the cwd.**

- **Symptom:** run from `/tmp`, the staged bundle carried `// ../mnt/user-data/<user>/…/packages/wallet-crypto/src/…` comments. That leaks a local path into a public tarball, and the bytes depend on where the script runs.
- **Fix:** `stage.ts` refuses any cwd but the repo root. A test also rejects any module comment outside `packages/<pkg>/src/`.

**Emitted declarations carried maintainer-only file headers:**

- "the extension and the playground both activate it";
- "Why a private package";
- a plan path in `resolve-asset`.

**Fix:** the publish tsconfigs set `removeComments`. The READMEs carry the contracts instead.

`tsc` also drops `encryption-key.ts`'s line-1 Azguard notice, because it attaches to an elided import. `stage.ts` re-adds the source's notice to the bundle and to that declaration.

**Ordinary comment-only edits leave the staged bytes unchanged.** Probe: add a line comment and a JSDoc block to `account-derivation.ts`, then compare the staged files. Every `dist/*` file and `package.json` hashed the same. The staged bytes move with:

- a code change;
- a change to an Azguard first line;
- a file move (the module labels);
- a `/*! … */` legal comment, which Bun keeps (probed);
- a `@__PURE__` / `#__NO_SIDE_EFFECTS__` annotation, which changes what the bundle keeps.

**`skipLibCheck` hides TS2834** (extensionless relative imports in a `.d.ts` under NodeNext). A lib check fails as a whole, because `@aztec/foundation`'s declarations fail it (`Buffer`, and an untyped `util`). So the fixture type-checks with `skipLibCheck`, and a separate assertion requires `.js` on every relative declaration import. *Revised after review:* a second run with the lib check on is usable after all when it is judged by *where* the diagnostics fall: every one must have a location, and none may sit under `node_modules/@alejoamiras/`. `IsAny` alone never caught an unresolved import, because TypeScript types it as its internal error type, not `any`.

**Mutation probes (each restored afterwards):**

| Mutation | Caught by |
|---|---|
| Signing separator +1 | Bun and Node vector legs |
| Declarations written without the `.js` rewrite | the declaration-specifier test (the NodeNext type-check did **not** catch it) |
| `@aztec/*` not external | staging fails closed |
| Banner dropped | the Azguard test |
| A stray file in `dist/` | the allowlist test |

**Biome does not lint `scripts/`.** `biome.json` includes only `apps/`, `infra/`, `packages/` and `scripts/ci-cd/test-soak/`. The new scripts were checked with a scratch config that extends the root one: two functions over the complexity budget were split, then formatted.

### Review round 1 (codex + a four-lens review workflow, 23 confirmed findings)

Codex: changes needed (shared cache in the publish build, `--out packages` deletes sources, the idempotent skip proves no provenance, the fixture masks missing peers, file modes). The workflow confirmed 23 findings (4 medium) and refuted 2 that concerned merged refs. All adopted; the ones that changed the design:

- **Bun trusts a warm cache.** The review's probe: poison a cached package's `index.js`, delete `node_modules`, run `bun install --frozen-lockfile` → the poisoned body is installed. Bun does not re-check the lockfile's sha512 against its cache, and `oven-sh/setup-bun` restores its binary without a hash either. So the job that makes the bytes (`pack`) restores no cache (`no-cache: true`, a fresh `BUN_INSTALL_CACHE_DIR`), installs with `--ignore-scripts`, and runs no test code; `test:release` runs in its own job.
- **Browser builds and builtins.** Probe (Bun 1.4.2, `target: "browser"`): `node:fs` stays an external `node:fs` import, but `path` and `crypto` are inlined as polyfills, recorded as metafile inputs `node:path` / `node:crypto` with bytes in the output. The existing `node:` import check could not see those. Staging now refuses any input with bytes in an output that is not under `packages/*/src`, and any input in two outputs.
- **Provenance after the fact.** The skip path publishes nothing, so verifying afterwards (a `verify` job with no privilege) is as good as verifying before, and it covers fresh publications too. The registry serves `/-/npm/v1/attestations/<name>@<version>`; the SLSA v1 statement's subject is `pkg:npm/%40scope/name@version` with the tarball's hex sha512, and `externalParameters.workflow` names repository, path and ref. The filter was probed against `@sigstore/core@3.0.0`: its real digest matches, a changed one is rejected. `npm audit signatures` verifies attestation signatures (probe: "1 package has a verified attestation") but does not fail on a package that has none, so presence and identity come from the statement check.
- **The address claim was wrong.** The npm README said consumers derive "the same Aztec accounts". The peer's `SchnorrAccount.json` at 5.2.0 has class id `0x0833459d…`; the wallet's frozen artifact has `0x0db53983…`. Keys match, addresses do not.

| New mutation | Caught by |
|---|---|
| Mode normalization removed | the reproducibility test, now run under umask 077 |
| Declarations written extensionless after staging | the declaration-specifier test **and** the lib-check run |
| `@aztec/stdlib` dropped from the schema-patch peers | the dependency-completeness test, the peer pin, both runtime legs |
| `sideEffect` flag ignored | the manifest test |
| `zod` inlined | staging fails closed (third-party input) |
| Marker guard removed | the guard test (sentinel deleted) |
| In-repository guard removed | the guard test, through a symlink |

### Review round 2 (codex): changes needed, 3 findings, all adopted

- **A parallel job can replace an artifact.** Name uniqueness stops a duplicate upload, not a delete-and-recreate: `upload-artifact` supports `overwrite: true` across jobs, through the job's runtime token, whatever `GITHUB_TOKEN` may do. So `test`, running beside `pack`, could swap `npm-tarballs` after `pack` uploaded it. `publish` and `verify` now download by `pack`'s `artifact-id` output (download-artifact v8.0.1 accepts `artifact-ids`; one ID lands directly in `path`) and check each tarball against a sha256 map `pack` outputs. Job outputs are written only by their own job.
- **Statement claims are not signer identity.** The repository, workflow and ref inside an SLSA statement are whatever the signer wrote, and `npm audit signatures` checks the signature and subject but not whose certificate signed it. `scripts/publish/verify-provenance.sh` now uses `gh attestation verify --bundle … --digest-alg sha512 --cert-identity-regex '^https://github\.com/<repo>/<workflow>@refs/heads/(dev|main)$' --cert-oidc-issuer https://token.actions.githubusercontent.com --deny-self-hosted-runners`. Probe on `@sigstore/core@3.0.0`: its own workflow is accepted, `other.yml` and a tarball with one gzip header byte changed are refused, each with gh's `verifying` error. gh reads a bundle file only by a `.json`/`.jsonl` name; the first probe run failed on that for all three cases, and the stderr assertion is what exposed it.
- **The guard test's fixture was shared.** `.stage-guard-probe` was a fixed path that two concurrent runs could clobber; it is now `mkdtempSync` inside the repo root.

Codex accepted post-publication verification as the gate and an older attested commit for identical bytes once the signer is authenticated. It rated findings 2, 4 and 5 of round 1 closed, and 1 and 3 closed by this round.

**Round 3 (codex): approve.** All three round-2 findings are closed, with no new ones. Codex checked the identity regex: it accepts `dev` and `main` and rejects `main-evil`, other repositories and substituted punctuation. The one remaining gap is the clean Actions rehearsal (the first `dry_run` dispatch from `dev`).

### After merge: the first dry-run dispatch (`publish-packages` run 36077225851, `0.0.1`)

`pack` passed on a real runner: cache-free install, `--ignore-scripts`, stage, pack, digests, artifact. `test` failed: `expect.addEqualityTesters is not a function` from `@aztec/foundation/dest/curves/bn254/field.js:413`, at load of `stage.test.ts`. The same `test:release` had passed in the PR's Quality run (174 pass).

- **Cause.** Under `bun test` a bare `expect` resolves in every module (probe: a plain helper module sees `typeof expect === "function"`, while `globalThis.expect` is `undefined`), and `field.js` calls `expect.addEqualityTesters` whenever `expect` is defined. The runtime transpiler cache hides it: a transpile cached by a non-test run lacks the injection. The PR job ran `test:all` (vitest under Bun) first and warmed the cache; the dispatch `test` job ran `test:release` cold. Local proof: the same import passes warm and throws with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`.
- **Fix.** `stage.test.ts` no longer imports `@aztec/*` in process: the source-vs-bundle checks (patch keys, EncryptionKey cross-compat and rejections) run in a `bun` child process (`cross.mjs`) like the consumer legs. `test:release` now sets `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, so PR CI runs cold as the publish job does. Mutation: re-adding the in-process import fails the cold run (4 fail, `addEqualityTesters` in the output).


## R — local rehearsal (2026-09-25)

The recipe lives in `tools/`:
- `extract.sh` produces the history import: clone, reset, filter, one bootstrap commit, then the audit.
- `rehearse.sh` applies B1's changes on a throwaway branch and runs the gate phase by phase.

Runs used the freeze SHA 6611f861 and the three tarballs staged from `dev` at ee66a233.

**Extraction.**
- 136 commits, 2,616 reachable blobs, and a 12 MB `.git`. Exactly one ref, `main`.
- `git log --follow apps/tools/src/main.ts` reaches `packages/faucet/src/main.ts` (2026-05-21).
- No bare `#N` is left in any message: every issue reference now reads `alejoamiras/nulo#N`.
- The filtered tip equals the freeze tree byte for byte, except the 14 plan files whose home paths `--replace-text` normalised (`check-paths.py tree`).
- **The plan's ancestor list was wrong in two places.** `packages/bridge-app` never existed on `dev`: no commit in its history touches it. `check-paths.py ancestry` failed on it, and the entry was dropped. `.github/workflows/contracts.yml` was missing; review round 2 below found it.

**Audit** (`audit.py`, over the final history, bootstrap commit included).
- Raw findings:
  - gitleaks: 65 in history, 0 in messages;
  - trufflehog, run with `--no-verification`: 4 in history, 0 in messages;
  - 10 sensitive-looking filenames;
  - 3 identities;
  - 1 absolute path.
- Every finding is triaged in `tools/audit-allowlist.txt`. Each key carries the first 16 hex of the SHA-256 of the value, never the value, and the report masks every source line.
- All are benign, and all are already public in nulo:
  - test vectors;
  - public addresses, class ids and artifact digests;
  - an upstream aztec-nr test vector compiled into the artifacts;
  - `REGISTER_SECRET_HASH`.
- Two findings were checked by hash, not read:
  - anvil's default dev keys #0 and #1, in the sandbox deployer;
  - canonical mainnet USDC, which trufflehog's Circle detector flags.
- The `.env.example` templates hold placeholders and public endpoints in every revision.
- The path hit is the guard's own comment, `/home/aztec-dev`.
- Identities: the owner's author identity (already public), GitHub web-flow, and the bootstrap commit's local identity.

**Byte-reproducibility, confirmed.** A local `stage.ts` + `npm pack` of 0.0.1 at ee66a233 matches all three digests of CI dry-run 36079582297 byte for byte (node 24.12.0, npm 11.6.2, bun 1.4.2 on both). So the 0.1.0 digests recorded in `approved-digests.json` are the bytes CI's pack job produces from the same sources, and the plan's fallback (a digest over unpacked contents) is not needed.

**Gate so far.**
- Before install, every script and hook path exists, and both `.env` probes are ignored.
- `bun install` resolves 721 packages from nulo's seeded lockfile and removes 16.
- `baseline:complexity` writes 3 acceptances.
- `lint`, `typecheck:all` and `test:all` pass: design 153, bridge-core 437 (9 skipped), tools 1,461.
- Identity:
  - `assertPackageIdentity` with `lockstepVia` finds one copy each of `@aztec/{aztec.js,stdlib}` through the schema patch and of `@aztec/{accounts,foundation}` through wallet-crypto, all at 5.2.0;
  - the testnet production bundle carries all three patched methods.
- `verify:deployments` finds every committed address equal to its recomputed one.
- `build:testnet` / `build:mainnet` plus `verify:build-target` pass, and `test:e2e` passes 29/29.
- The e2e specs differ from `main` only in specifiers and the formatter's reflow of them (25 files).
- Browser e2e (`e2e:tools`, 69 cells, one sandbox, 1.3 h): 68 passed. Cell 34b failed on `net::ERR_NETWORK_CHANGED`: a host network change aborted the test wallet's dynamic import of `HandshakeRegistry`. A flake: its spec re-run alone passed (1/1).
- Contracts:
  - forge: 157 tests in 21 suites, and the gas snapshot within tolerance;
  - halmos: 12 proofs, by name;
  - the ABI pins (8), keystone (10), hub keystone (2), `compile.sh --check`, and TXE (65);
  - bridge-core `test:integration`: 35 tests in 6 files;
  - the sole-consumer invariant and its self-test.
- The build regenerates `apps/tools/src/types/components.d.ts` (unplugin-vue-components drops `RouterLink` / `RouterView`), so a check for a clean `src/` fails after any build; the rehearsal checks only the files it edits.

**Recipe fixes found by the run.**
- **Derived files stay verbatim.** The codemod rewrote two comment lines in `packages/design/src/base.css`, which carries a "Modified from Azguard Wallet" header, and its pinned hash failed. Rewriting Azguard-derived code is under the freeze, so the codemod now skips any file carrying the marker. Its two `@nulo/design` comments remain for the brand-guard allowlist, and the hash pin keeps proving the copy is byte-identical to nulo's.
- **A bare `"@nulo/"` prefix** (`behavior-gating.test.ts` walks workspace deps by it) becomes `"@unleashed/"`, so the published three drop out of the walk.
- **Biome lints its own `biome.json`**, whatever `files.includes` says. The bootstrap formats it with nulo's pinned Biome (the same 2.5.13).
- **Longer specifiers cross the 120-column width.** B1 runs `bun run format` after the codemod.
- **`audit.py` deadlocked**: it wrote every blob id to `git cat-file --batch` before reading. It now feeds stdin from a thread.
- **Two bash traps in `rehearse.sh`.**
  - A function called from `if !` runs with errexit off, so each phase runs in its own `(set -e; …)` shell.
  - A trailing `grep && die` returns 1 when grep finds nothing, which ends the function in failure.
- **The e2e sandbox deploys from forge artifacts.** CI's tools-e2e job installs the pinned forge libraries first, and the rehearsal now does too.
- **This host's `/opt/ms-playwright` is root-owned** and holds chromium 1148 and 1234. Playwright 1.63 wants 1243, and `playwright install` hung on the unwritable store, so the rehearsal uses `~/.cache/ms-playwright`.
- **`test:release` on this host** fails 3 `zip-reproducible` tests: there is no `zip` binary. They are unrelated to the digests, and CI has `zip`.

### Review round 1 (codex, GPT-6 Astra high): changes required, 10 findings

Adopted:
1. **Diff-based scanning misses merge-resolution content.** Both scanners read history through `git log` without merge diffs, and the history has 13 merges. `audit.py` now writes every reachable blob to a scratch directory under its path and runs `gitleaks dir` and `trufflehog filesystem` over it.
   - Completeness is proven, not assumed: each scanner must report reading at least every text byte written.
   - The first such run caught gitleaks silently skipping two SVGs (1,988 bytes), which its default config path-allowlists. gitleaks is now held to text bytes minus SVGs, and trufflehog, which has no path allowlist, to all of them.
   - Binary blobs outside images and fonts, and lines over trufflehog's 10 MiB truncation limit, fail the audit. The history has five woff2 blobs, and its longest line is 114 KB.
2. **The masked source line could print a second secret on the same line.** Reports now give the key, the blob or message, and the line; scanner errors give the exit code only.
3. **Strict parsing.** gitleaks must return a JSON array; every non-blank trufflehog line must parse with its required fields, and its `finished scanning` summary must be present.
4. **The workspace commits were never audited.** `rehearse.sh` gained an `audit` phase over main plus the rehearsal branch, with its own allowlist (`audit-allowlist-workspace.txt`). Tarball specs are relative (`file:../../../tgz/…`), so no scratch path enters manifests or the lockfile.
5. **Home-path forms.** Detection and normalisation now also cover usernames starting with a digit or underscore, `/root`, and Windows `X:\Users\name`. Nothing new matched: run3's filtered history is object-identical to run2's (same filtered tip, same bootstrap tree).
6. **A method-name grep does not prove the schema mutation.** Names also appear at call sites.
   - The identity phase now imports `WalletSchema` from `apps/tools`' own resolution and asserts none of the three methods exist before the published `register` runs, and all three after.
   - The bundle check looks for the patch body's own error text, which survives tree-shaking only if the register call does.
7. **The test-diff comparison was too loose.** Stripping all whitespace equated `"a b"` with `"ab"`. Both sides are now un-renamed and run through `biome format`, then compared exactly. Every subprocess is checked, and the specs must be clean in the worktree.
8. **Rename detection cannot prove complete ancestry.** `check-paths.py ancestry` now also flags moves rename detection could not pair: a diff, merges against each parent, that adds a listed file and deletes a same-named unlisted one. Three pairs came up, all name coincidences, recorded in `lineage-reviewed.txt`. The first version, without rename detection, flooded on the `packages/` → `apps/` restructure (#186).
9. **The tree exception accepted any replacement.** Each filtered blob is now re-derived from the freeze bytes plus `replace-text.txt` and compared by object id.
10. **Comments** naming workflow stages, and one narrating one, were rewritten.

Negative control: a throwaway repo with a planted AWS-style key, a Windows home path and an unknown identity fails the audit with all three reported by location.

### Review round 2 (codex): changes required, 3 not closed + 2 new, all adopted

Closed: 2, 3, 4, 5, 7, 9, 10.

Not closed, now fixed:
1. **Aggregate byte counts cannot prove per-file coverage.** trufflehog counts overlapping chunks, so surplus bytes can hide an unread file, and a NUL-prefixed blob contributed nothing to either count.
   - Every scanned file (blob or message) now ends in a canary unique to it, a GitHub-token-shaped string both scanners report. Each scanner must report every file's canary, so skipping a file or stopping short in one fails the audit.
   - A missed canary gets one retry as plain text: under a bare number, after a neutral first line, with a fresh canary. A file a scanner cannot read misses twice.
   - **The canaries found a real gap the byte totals hid.** trufflehog never reads content it sniffs as SVG, under any name: `favicon.svg` and `token-sprite.svg` were never scanned by it. A neutral first line defeats the sniffing; both are now read, and both are clean.
   - Two more false misses: trufflehog drops unverified results that contain a dictionary word ("REad", "dIeN", "PKCS", "X509", "2048"). A vowel-free alphabet cuts the rate to about 1.5 in 10,000, and the retry absorbs the rest.
   - Binaries are fingerprinted, never passed by extension: each needs a `binary:<oid>` key, by content alone because one blob can sit at several paths. All five are woff2 fonts whose SHA-256 the third-party-notices font policy pins.
6. **The bundle grep proves text, not execution.** The browser proof is e2e cells 35 and 36 on the production-mode local build. add-to-wallet reaches a test wallet only through `registerToken` on the app's own wallet proxy, which lives on a separate origin from the wallet and has its own `WalletSchema`. The new `control` phase removes the register import and runs the drip spec.
   - All three add-to-wallet cases must fail with `data-add-status="error"`, the call throwing on a proxy with no such method.
   - Cell 38, which uses only standard methods, must still pass, or the run proves nothing.
   - The first draft expected cell 35 to keep passing. It does not: even the wallets that refuse the method need the app to send it first, so cell 35 is patch-dependent too.
   - Result on run2: without the import, cell 38 passes and cells 35, 35 and 36 fail with `data-add-status="error"`. With it, all four pass in the full e2e run. The phase exits 0 end to end.
   - A bash trap in the phase's first version referenced a function-local variable. That variable is gone by the time a subshell's EXIT trap fires, so `set -u` failed the phase after every check had passed. The trap now expands its paths when set.
8. **Ancestry was name-bound below 50% similarity.** Renames are now paired down to 10%. That surfaced one real ancestor, `.github/workflows/contracts.yml`: the `contracts/bridge/**` PR gate, rewritten into `bridge-contracts.yml` at 43% similarity in #575. It is now in `paths.txt`. The three reviewed basename pairs now pair with their true, listed sources, so `lineage-reviewed.txt` is empty. The stated limit: a move that keeps under 10% of the content under a new basename looks like a new file.

New:
- **High: a commit message could name a scratch file.** Messages were split on delimiters that a message body can contain, so a body with `\x01<path>\x01` became a "sha" and an open-for-write target. Commit ids now come from `rev-list --all`, each validated as 40 hex, and messages from length-framed `cat-file --batch` reads.
- **Medium: inline suppressions bypassed triage.** Both scanners honour inline markers (`gitleaks:allow`, `trufflehog:ignore`); trufflehog has no switch to stop.
  - gitleaks runs with `--ignore-gitleaks-allow`, an explicit default-only config, an empty ignore path and cwd, and no `GITLEAKS*` / `TRUFFLEHOG*` environment.
  - `trufflehog:ignore` is disarmed in the scanned copy.
  - The scanner versions are pinned and checked at start.
  - Every canary line carries `gitleaks:allow`, which proves the flag on every file.

Negative control: a throwaway repo with a secret behind `gitleaks:allow`, one behind `trufflehog:ignore` (and a mixed-case spelling), one in an SVG, one in `yarn.lock`, an unreviewed binary, an ambient `GITLEAKS_CONFIG` that allowlists everything, and a message carrying `\x01<path>\x01`. Every secret is reported by both scanners and the binary is untriaged. Nothing is written outside scratch.

Re-run (run4, a fresh extraction with the new `paths.txt`): history audit PASS, with 2,613 text blobs and 136 messages read to their canary by both scanners. Its tip tree is `68530770…`, identical to run3's, so run3's gate results carry over. run3's workspace audit is also PASS.
