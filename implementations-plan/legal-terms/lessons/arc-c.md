# Arc C lessons — third-party notices

## How the two blockers cleared

- **Presto.** The MIT versions existed under the `testnet` dist-tag while `latest` still pointed at
  the AGPL ones, so `npm view <pkg> license` alone said "still blocked". Checking `dist-tags` and
  the per-version `license` is what found them. Before taking them under a dated min-age exclude,
  the old and new tarballs were diffed: LICENSE, README, the `license` field, one devDependency
  and one source comment. A relicensing bump that also changed code would have been a different
  review.
- **`@aztec/sqlite3mc-wasm`.** The package has no licence field and no licence file, but its README
  documents a full verification chain: an upstream sqlite3mc release archive pinned by SHA-256.
  Re-running it (archive hash, then `sqlite3.wasm` and the OPFS proxy against the installed files)
  matched byte for byte, which is what makes the override an observation rather than a guess.

## What bit

- **The plan assumed one package lacked licence metadata; nineteen do.** Every bundled `@aztec/*`
  package except `bb.js` and the two noir packages has neither a `license` field nor a licence
  file, and those three have the field but no file (as does `hash.js`). A probe build that dumped
  `chunk.modules` per bundle, before any generator code existed, turned this from a late surprise
  into the data model: overrides are groups of names bound to one `reviewedVersion`, so an Aztec
  bump is one deliberate edit and cannot slide through.
- **Rolldown reports tree-shaken modules with `renderedLength: 0`** (197 of 2,080 here) rather than
  omitting them, so "the keys of `chunk.modules`" over-reports. It made no difference to the
  package set in this build, which is exactly why it needs a fixture test and not an observation.
- **Worker bundles are invisible to the main plugin list.** Four worker builds (two bb workers, the
  bb main worker, the sqlite worker) run with `worker.plugins` only. `comlink` exists nowhere else,
  which makes it the canary the expected-minimum list uses for "a worker build was seen".
- **The Vite config loads workspace packages through Node's type stripping**, not through a
  bundler: relative imports need a real `.ts` extension (so `allowImportingTsExtensions` in every
  tsconfig that type-checks the package, the extension's included), and parameter properties are a
  syntax error. `bunx tsc` and vitest were both green while the actual build could not start.
- **The CI gating test demands `src/**` + `package.json` per dependency, literally.** A whole-package
  glob covers more and still fails it; the extra inputs (`texts/`, `bin/`, the expected-minimum
  list) are listed beside the two conventional lines instead.
- **`bun run typecheck` at the repo root needs `vue-tsc` on PATH** and is not what CI runs;
  `typecheck:all` is.

## Decisions worth keeping

- **No allowlist change for SQLite's public-domain code.** The wasm's entry is issued under
  sqlite3mc's MIT licence, as upstream distributes the combined work, and reproduces upstream's own
  bundle header, which states the public-domain dedication and the Emscripten terms. Adding the
  SPDX `blessing` id would have been defensible and was still a policy change nobody asked for.
- **Stale records fail too.** An override the package no longer needs, one that matches nothing
  bundled, a vendored claim that never fires: each is a refusal. A list of exceptions that can only
  grow stops being read.
- **Byte-stability was checked on real output**, not only in fixtures: a smoke-env Chrome build, a
  production Chrome build and a Firefox build produced the same SHA-256.

## Codex fix loop

**Round 1 (GPT-6 Astra, `high`): reject.** Ten findings, all accepted:

- *Attribution completeness is not provenance.* Byte-identity with the upstream archive proved where
  `sqlite3.wasm` came from, not what it contains. Reading sqlite3mc's source tree at the pinned tag
  found Olivier Gay's sha2 (BSD-3-Clause) and libaegis (MIT) compiled in; both now have entries.
  (Upstream's own `filelist.md` still calls `rijndael.*` LGPL with the wxWindows exception; the
  file headers at the tag say MIT over a public-domain original, and the headers are what ships.)
- *The nearest manifest is not the owner.* Owner resolution now reads the installation root; a
  nearer manifest naming another package is reported as embedded code.
- *Legacy licence metadata was erased before override validation*, so an override could bury an
  AGPL `licenses: []`. Legacy forms are now read into the same string the checks compare.
- *A NOTICE, an empty LICENSE and a `LICENSE.js` all counted as a licence file.*
- *Deduplication ran before validation*, so of two installations of one version only the first
  was checked.
- *A stylesheet renders zero bytes of JavaScript and still ships*, so dropping on length dropped
  CSS-only packages; and only `.wasm` assets needed a claim, so copied `.js` did not.
- *The Buffer shim's component records were not bound to the host's version.*
- *Storybook loads the shared Vite config*, where the policy's stale-record checks would have
  refused its smaller bundle; the plugin moved to the Chrome and Firefox wrappers.
- *An 80-`=` line inside a licence text could forge a name for the CI check*; the file now opens
  with an inventory that is the only thing the check reads.
- *The CI step's target handling lived in untested shell*; it is now a tested function.

Both targets rebuilt under the stricter policy with identical output (135 entries).
