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

**Round 2: reject.** Six findings, each reproduced by Codex with a probe, all accepted:

- *A malformed licence declaration read as "absent"*, which is exactly what an override may fill:
  `licenses: [{type: "AGPL-3.0-only"}, {}]` passed under an MIT override. Unreadable is now its own
  state and nothing can stand in for it.
- *The embedded check trusted the nearest differing name only*: a reviewed inner name at the wrong
  version passed, and a reviewed child hid an unreviewed package above it. The whole manifest
  chain is now held against the root or against a record of that exact name, version and licence.
- *A file name is not provenance.* `assets/worker-hostile.js` satisfied the "Vite worker output"
  claim with no worker recorded. Script assets are now accepted only when a recorded worker build
  wrote that exact file, and the one remaining generated claim (the crx content-script loader)
  must match the loader's whole text.
- *The Emscripten notice pointed at musl's COPYRIGHT without including it*, and `strings` finding
  no `argon2` symbol proved nothing: AEGIS calls Argon2 directly. The inventory now comes from
  upstream's build inputs (the amalgamation, default ciphers, no optional extensions).
- *A manifest version of `"1\ncomlink@1"` forged an inventory row.* Manifest fields must be single
  tokens, and the inventory is read at a fixed position with a verified row count.
- *Worker records were keyed by output file names*, so a changed hash added a record instead of
  replacing one and a removed worker lingered. Keyed by entry module now, and used only while the
  main bundle still carries the files that build wrote.

A slip worth recording: the edit that replaced the worker claim also deleted the three wasm
claims, and the next real build refused with all four assets named. The policy caught its own
author.

**Round 3: reject. The loop stopped at its three-round cap without an approval.** Four findings,
each reproduced, each fixed with a regression test, **none re-reviewed**:

- The worker exemption covered every file a worker build wrote, including assets it copies; it now
  covers only the chunks it compiled.
- A nested manifest with a licence but no name and version was skipped as if it were a bare
  `{ "type": "module" }` marker; anything that states a name, a version or a licence now counts.
- Only the first of `license` / `licenses` was validated; both must be readable and agree.
- An inline worker ships as a string inside its importer and reaches no worker build; such an
  import is refused (there is none in the tree).

What the three rounds say about the problem, not the patch: every finding was a way for a
*crafted* dependency to keep its licence out of a notices file. None was a way for an ordinary
dependency to do so, and the real build's output did not change across rounds 2 and 3 except for
the components the sqlite inventory added. The generator is a compliance tool, not a security
boundary against a hostile package, which would have worse options than hiding its licence. Round 1
and the sqlite inventory were the findings with legal weight; the rest is hardening with
diminishing returns. A fourth round is the owner's call.

**Round 4 (authorised by the owner beyond the cap, as the last): reject, one finding.** The four
round-3 fixes held. Judged as a compliance generator rather than a security boundary, Codex found
one *ordinary* gap: a CSS `@import` of a package stylesheet is inlined by Vite's CSS pipeline and
never appears in `chunk.modules`, so a CSS-only theme or reset would ship unattributed and
unchecked. Fixed with a `transform` hook that reads each stylesheet's import specifiers, resolves
them through the bundler and follows them from disk.

The first attempt used `this.getWatchFiles()` in `generateBundle`, where Vite registers CSS
dependencies. The unit test passed against a fake context; **the real build threw
`getWatchFiles is not a function`** — Rolldown's `generateBundle` context does not have it. The
second attempt was proven the same way: a temporary `@import` of a package stylesheet made the
real build refuse, naming that package, and the clean builds kept their previous hash. A plugin
test against a hand-made context proves the logic, never the host API. **This fix has not been
re-reviewed.**

Closing round 4, Codex verified that one finding only: **not resolved**, because the specifier
pattern required quotes and `@import url(pkg/theme.css);` is ordinary CSS. The reader now takes
quoted, `url("…")`, bare `url(…)` and comma-list forms, pinned by a table test, and the bare form
was proven on a real build the same way as the quoted one.

The second verification found the next variant (an extensionless `@import url(pkg/base)`), which is
the signature of chasing a resolver's semantics one spelling at a time. The rule became structural
instead: try the spellings a CSS, Sass or Less pipeline tries, and **refuse the build on any import
that still cannot be followed**. Unresolvable no longer means invisible. The real extension build
has no such import (both targets pass, same hash), and the extensionless probe is refused by name.

The third verification found the last variant (an extensionless import beside a same-named script
resolved to the script); a candidate now counts only if it is a style file. **Codex then returned
`RESOLVED` and `conditional-approve`**, its one condition being that the regression the commit
message claimed was not in the tree. It was right: Biome had reformatted the test file, the
scripted edit's anchor no longer matched, and the edit silently did nothing while the commit
message said otherwise. The regression is now in, and was shown to fail with the fix removed.
A scripted edit needs an assertion that it applied; a commit message is not evidence.

**Loop outcome: converged at conditional-approve, condition met**, in four rounds (the fourth
authorised by the owner) plus three verifications scoped to round 4's single finding.
