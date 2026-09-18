# @nulo/third-party-notices

Generates `THIRD-PARTY-NOTICES.txt`, the file that carries every bundled component's copyright and
permission notice **inside** the shipped extension. MIT, BSD and Apache-2.0 all require that; a
notice that exists only on GitHub does not satisfy them.

One concern: given what a build rendered, produce the notices or refuse the build.

## How it decides what ships

Input is the **rendered** module set of every emitted chunk (`chunk.modules`), not every module the
bundler loaded: a tree-shaken script contributes no code, and naming its package would claim
something the artifact does not contain. Stylesheets and other resources render zero bytes of
JavaScript while their content ships as an asset, so only script modules are dropped on length. The
Vite plugin is registered for the main build **and** for worker builds (`worker.plugins`), which are
separate bundles the main plugin list never sees; the main build emits the file once. It is
registered from the Chrome and Firefox wrapper configs only: Storybook and vitest load the shared
config, and the policy describes the shipped extension.

Each module maps to the manifest at its **installation root** (`node_modules/<name>`), never to a
nearer `package.json`, which a package could plant in any subdirectory. Every named manifest found
between the module and that root is held to account: one of the same name must agree with the root
(version and licence), and one of another name is embedded code that needs a `VENDORED` component
record of exactly that name, version and licence. A file inside the
workspace and outside every `node_modules` is first-party; a real file anywhere else refuses the
build rather than vanishing. Every installation is validated before duplicates are merged.

## Policy — the build fails on anything not reviewed

| Case | Result |
|---|---|
| Licence expression not satisfied by `ALLOWED` (`OR`: any branch, `AND`: every branch; a `WITH` exception never matches) | refused |
| No licence metadata, or an unparseable expression (legacy `{ type }` and `licenses: []` forms are read, an array as a choice) | refused unless an `OVERRIDES` entry covers it |
| A licence declaration that is present but unreadable, `license` and `licenses` that disagree, or a manifest `name` / `version` that is not one well-formed token | refused; no override can stand in |
| A manifest below the installation root that states a name, a version or a licence without identifying a package (a bare `{ "type": "module" }` marker is fine) | refused |
| An inline worker (`?worker&inline`): Vite embeds it in the importing chunk as a string, so its modules reach no bundle | refused |
| No non-empty licence / copying file at the package root (a `NOTICE` is reproduced but never stands in; `LICENSE.js` is code) | refused unless an `OVERRIDES` entry supplies the text |
| One `name@version` installed twice with differing licence content | refused |
| A module from outside the workspace and outside `node_modules`, or a package embedding another named package | refused |
| `OVERRIDES` entry whose `reviewedVersion` is not the installed version | refused — re-verify, then bump it |
| `OVERRIDES` entry the package no longer needs, or that matches nothing bundled | refused — delete it |
| Package declares a licence its `OVERRIDES` entry neither uses nor acknowledges (`declared`) | refused |
| Emitted code asset (`.wasm`, `.wasm.gz`, `.js`) that is not a chunk a recorded worker build compiled and that no `VENDORED` asset claim covers, or a claim whose covering package is not bundled | refused |
| A `generated` claim whose asset's whole text is not the shape that tool writes (a file name proves nothing) | refused |
| `VENDORED` entry that matches nothing, accounts for nothing, was reviewed at another host version, or whose component lacks an `https` source, a text, or an allowed licence | refused |

All violations of one build are reported together, each naming its package.

**The generator never writes a copyright line.** Every text is either a file the package ships or a
file under `texts/` copied verbatim from the `source` URL its entry records (a tag or a commit, never
a branch). An override cannot launder a licence: its expression goes through the same allowlist.

## Files

| File | Role |
|---|---|
| `src/spdx.ts` | SPDX expression parser + allowlist evaluation |
| `src/packages.ts` | module id → owning package; licence-file discovery |
| `src/collect.ts` | rendered modules + assets out of an output bundle |
| `src/policy.ts` | `ALLOWED`, `OVERRIDES`, `VENDORED` — the reviewed records |
| `src/generate.ts` | policy checks + byte-stable rendering; `noticeNames` parses a rendered file |
| `src/plugin.ts` | the thin Vite shell (`main` + `worker`) |
| `src/check-minimum.ts`, `bin/check-minimum.ts` | CI: a built dir's notices ⊇ `expected-minimum.txt` |
| `texts/` | verbatim upstream licence texts the overrides and vendored components cite |

`src/` is loaded by the Vite config through Node's type stripping: relative imports carry `.ts`, and
no syntax that needs transformation (parameter properties, enums) is allowed.

## When a build is refused

- **An `@aztec/*` bump** trips every Aztec override's `reviewedVersion`. Re-check that the upstream
  LICENSE files at the new tag are unchanged (`texts/` must stay byte-identical to the tagged
  source, or be refreshed from it), that the noir submodule commit and the sqlite3mc pin
  (`scripts/vendor.pin` upstream; the package README states it) still match the recorded notes, then
  bump `reviewedVersion` and the URLs in `src/policy.ts`.
- **A new dependency without a licence file**: prefer a dependency that ships one. Otherwise add an
  `OVERRIDES` entry with the text copied from a tagged upstream URL.
- **A new compiled asset**: add a `VENDORED` claim naming the package whose entry covers it, or the
  components compiled into it.

The file opens with a `COMPONENTS (n)` inventory (`title<TAB>licence`) at a fixed position above
every third-party text, and that inventory is the only thing `noticeNames` and the CI check read; a
missing inventory or a row count other than `n` throws. Licence text cannot forge a row, and neither
can a manifest, whose fields are refused unless they are single tokens.

A worker's record is keyed by its entry module and used only while the main bundle still carries
the files that build wrote, so a changed worker replaces its record, a removed one drops out, and
one Vite served from cache stays.

## Known limits

- `sqlite3.wasm` was inventoried from its build inputs: upstream's release workflow compiles the
  sqlite3mc amalgamation with the default cipher set and no optional extension. Besides sqlite3mc's
  own MIT code and public-domain / CC0 code, that compiles in Olivier Gay's sha2 (BSD-3-Clause),
  libaegis (MIT) and the Argon2 reference implementation (CC0-1.0 OR Apache-2.0), which have their
  own entries; the Emscripten runtime brings musl libc, whose notice rides with Emscripten's. `barretenberg.wasm` and the noir
  wasm have **not** been inventoried to that depth: they are attributed to the project that
  publishes them, under its licence files.
- Third-party source copied into a first-party directory is invisible to any module walk.
- The bundled fonts (`@nulo/design`) are outside this generator; see the open items in `implementations-plan/legal-terms/plan.md`.

## Scripts

`bun run test` · `bun run typecheck` · `bun bin/check-minimum.ts <build-dir>…`
