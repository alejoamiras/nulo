# @nulo/third-party-notices

Generates `THIRD-PARTY-NOTICES.txt`, the file that carries every bundled component's copyright and
permission notice **inside** the shipped extension. MIT, BSD and Apache-2.0 all require that; a
notice that exists only on GitHub does not satisfy them.

One concern: given what a build rendered, produce the notices or refuse the build.

## How it decides what ships

Input is the **rendered** module set of every emitted chunk (`chunk.modules` with
`renderedLength > 0`), not every module the bundler loaded: a tree-shaken module contributes no code,
and naming its package would claim something the artifact does not contain. The Vite plugin is
registered for the main build **and** for worker builds (`worker.plugins`), which are separate
bundles the main plugin list never sees; one shared collector gathers both and the main build emits
the file once.

Each module id maps to its owning `package.json` (nearest ancestor with a name and a version, never
above its `node_modules`). Paths without a `node_modules` segment are first-party and skipped.

## Policy — the build fails on anything not reviewed

| Case | Result |
|---|---|
| Licence expression not satisfied by `ALLOWED` (`OR`: any branch, `AND`: every branch; a `WITH` exception never matches) | refused |
| No `license` field, a legacy object/array form, or an unparseable expression | refused unless an `OVERRIDES` entry covers it |
| No licence / copying / notice file at the package root | refused unless an `OVERRIDES` entry supplies the text |
| `OVERRIDES` entry whose `reviewedVersion` is not the installed version | refused — re-verify, then bump it |
| `OVERRIDES` entry the package no longer needs, or that matches nothing bundled | refused — delete it |
| Package declares a licence its `OVERRIDES` entry neither uses nor acknowledges (`declared`) | refused |
| Emitted `.wasm` / `.wasm.gz` with no `VENDORED` asset claim, or a claim whose covering package is not bundled | refused |
| `VENDORED` entry that matches nothing, lacks an `https` source, a text, or an allowed licence | refused |

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

## Known limits

- A compiled asset is attributed to the project that publishes it. Third-party code statically
  linked *inside* `barretenberg.wasm` or the noir wasm is not enumerated beyond what upstream's own
  licence files state.
- The bundled fonts (`@nulo/design`) are outside this generator; see the open items in `implementations-plan/legal-terms/plan.md`.

## Scripts

`bun run test` · `bun run typecheck` · `bun bin/check-minimum.ts <build-dir>…`
